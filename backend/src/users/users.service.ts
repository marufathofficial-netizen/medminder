import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async create(userData: {
    name: string;
    email: string;
    password: string;
    role: string;
  }): Promise<UserDocument> {
    const user = new this.userModel({
      ...userData,
      email: userData.email.toLowerCase(),
    });

    return user.save();
  }
}